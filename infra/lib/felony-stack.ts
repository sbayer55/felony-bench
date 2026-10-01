import { readFileSync } from 'node:fs'
import { CfnOutput, Duration, RemovalPolicy, Size, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as dlm from 'aws-cdk-lib/aws-dlm'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import type { Construct } from 'constructs'

export interface FelonyStackProps extends StackProps {
  /** Public hostname, e.g. felonybench.com. Gets an A record and a Let's Encrypt cert via Caddy. */
  domainName: string
  /** Existing Route 53 hosted zone that contains domainName. */
  hostedZoneId: string
  hostedZoneName: string
  /** Contact address for Let's Encrypt. */
  acmeEmail: string
  /** owner/name on GitHub: cloned onto the box, images pulled from ghcr.io/owner/name. */
  githubRepo: string
  /** False when the account already has GitHub's OIDC provider (only one is allowed per account). */
  createOidcProvider: boolean
}

const APP_TAG = 'felony-bench'
const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com'

/**
 * One EC2 instance runs every container (Postgres, API + SPA, Caddy, the daily refresh).
 * State lives on a separate, retained EBS volume with daily snapshots, so the instance is disposable.
 */
export class FelonyStack extends Stack {
  constructor(scope: Construct, id: string, props: FelonyStackProps) {
    super(scope, id, props)
    Tags.of(this).add('App', APP_TAG)

    // One public subnet, no NAT gateway.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    })
    const subnet = vpc.publicSubnets[0]

    // Web only. Shell access goes through SSM Session Manager, so no SSH port.
    const sg = new ec2.SecurityGroup(this, 'WebSg', { vpc, description: 'Felony Bench web' })
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP (ACME + redirect)')
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS')
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(443), 'HTTP/3')

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    })
    // Refresh provider keys (SecureString, default aws/ssm key) live under /felony-bench/env/.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParametersByPath', 'ssm:GetParameters', 'ssm:GetParameter'],
      resources: [this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: 'felony-bench/*' })],
    }))

    const data = new ec2.Volume(this, 'DataVolume', {
      availabilityZone: subnet.availabilityZone,
      size: Size.gibibytes(20),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    Tags.of(data).add('Backup', APP_TAG)

    const userData = ec2.UserData.forLinux()
    userData.addCommands(
      `VOLUME_ID='${data.volumeId}'`,
      `DOMAIN='${props.domainName}'`,
      `ACME_EMAIL='${props.acmeEmail}'`,
      `GITHUB_REPO='${props.githubRepo}'`,
      readFileSync(new URL('./bootstrap.sh', import.meta.url), 'utf8'),
    )

    const instance = new ec2.Instance(this, 'Host', {
      vpc,
      vpcSubnets: { subnets: [subnet] },
      securityGroup: sg,
      role,
      instanceType: new ec2.InstanceType('t4g.small'),
      // Cached in cdk.context.json so a new AMI release never replaces the box on deploy.
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64, cachedInContext: true }),
      blockDevices: [{ deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(16, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }) }],
      requireImdsv2: true,
      userData,
    })
    Tags.of(instance).add('Name', APP_TAG)

    new ec2.CfnVolumeAttachment(this, 'DataAttachment', {
      instanceId: instance.instanceId,
      volumeId: data.volumeId,
      device: '/dev/sdf',
    })

    const eip = new ec2.CfnEIP(this, 'Ip', { domain: 'vpc' })
    new ec2.CfnEIPAssociation(this, 'IpAssociation', { allocationId: eip.attrAllocationId, instanceId: instance.instanceId })

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    })
    new route53.ARecord(this, 'Dns', {
      zone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromIpAddresses(eip.ref),
      ttl: Duration.minutes(5),
    })

    // Daily snapshots of the data volume, last 7 kept.
    const dlmRole = new iam.Role(this, 'SnapshotRole', {
      assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSDataLifecycleManagerServiceRole')],
    })
    new dlm.CfnLifecyclePolicy(this, 'Snapshots', {
      description: 'Felony Bench data volume daily',
      state: 'ENABLED',
      executionRoleArn: dlmRole.roleArn,
      policyDetails: {
        resourceTypes: ['VOLUME'],
        targetTags: [{ key: 'Backup', value: APP_TAG }],
        schedules: [{
          name: 'daily',
          createRule: { interval: 24, intervalUnit: 'HOURS', times: ['05:00'] },
          retainRule: { count: 7 },
          copyTags: true,
        }],
      },
    })

    // GitHub Actions (main branch only) may run the deploy script on the box via SSM, nothing else.
    const oidcArn = props.createOidcProvider
      ? new iam.CfnOIDCProvider(this, 'GithubOidc', {
          url: `https://${GITHUB_OIDC_HOST}`,
          clientIdList: ['sts.amazonaws.com'],
        }).attrArn
      : this.formatArn({ service: 'iam', region: '', resource: 'oidc-provider', resourceName: GITHUB_OIDC_HOST })
    const deployRole = new iam.Role(this, 'DeployRole', {
      description: 'GitHub Actions deploy for Felony Bench',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(oidcArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_OIDC_HOST}:sub`]: `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }, 'sts:AssumeRoleWithWebIdentity'),
    })
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:SendCommand'],
      resources: [this.formatArn({ service: 'ssm', region: this.region, account: '', resource: 'document', resourceName: 'AWS-RunShellScript' })],
    }))
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:SendCommand'],
      resources: [this.formatArn({ service: 'ec2', resource: 'instance', resourceName: '*' })],
      conditions: { StringEquals: { 'ssm:resourceTag/App': APP_TAG } },
    }))
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:ListCommandInvocations', 'ssm:GetCommandInvocation'],
      resources: ['*'],
    }))

    new CfnOutput(this, 'ElasticIp', { value: eip.ref })
    new CfnOutput(this, 'InstanceId', { value: instance.instanceId })
    new CfnOutput(this, 'DataVolumeId', { value: data.volumeId, description: 'Retained on stack delete' })
    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn, description: 'GitHub repo variable AWS_DEPLOY_ROLE_ARN' })
    new CfnOutput(this, 'Shell', { value: `aws ssm start-session --target ${instance.instanceId}` })
  }
}

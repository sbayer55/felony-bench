import { App } from 'aws-cdk-lib'
import { FelonyStack } from '../lib/felony-stack.ts'

const app = new App()

function context(key: string): string {
  const value = app.node.tryGetContext(key)
  if (typeof value !== 'string' || !value) throw new Error(`Missing context: pass -c ${key}=… (see infra/README.md)`)
  return value
}

new FelonyStack(app, 'FelonyBench', {
  // A concrete account/region is required: the AMI and AZ lookups are cached in cdk.context.json.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  domainName: context('domainName'),
  hostedZoneId: context('hostedZoneId'),
  hostedZoneName: context('hostedZoneName'),
  acmeEmail: context('acmeEmail'),
  githubRepo: context('githubRepo'),
  createOidcProvider: app.node.tryGetContext('createOidcProvider') !== false && app.node.tryGetContext('createOidcProvider') !== 'false',
})

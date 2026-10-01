import { describe, expect, it } from 'vitest'
import enums from '../../shared/enums.json'
import { ATTRIBUTION, CATEGORIES, DEGREES, EVIDENCE_CLASSES, ROLES } from './schema'

// shared/enums.json feeds the Rust API and the database CHECK constraints (api/tests/api.rs checks those).
describe('shared enums', () => {
  it('match the zod schema', () => {
    expect(enums).toEqual({
      categories: [...CATEGORIES],
      evidenceClasses: [...EVIDENCE_CLASSES],
      roles: [...ROLES],
      attribution: [...ATTRIBUTION],
      degrees: [...DEGREES],
    })
  })
})

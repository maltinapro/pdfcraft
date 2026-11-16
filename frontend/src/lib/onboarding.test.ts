import { describe, expect, it } from 'vitest'
import { onboardingOpen, onboardingSteps } from './onboarding'

describe('getting started checklist', () => {
  it('starts with every step open', () => {
    const steps = onboardingSteps({ companyDone: false, documents: 0, lastBackup: null })
    expect(steps.map((s) => s.done)).toEqual([false, false, false])
    expect(steps.map((s) => s.route)).toEqual(['sender', 'invoice', 'data'])
    expect(onboardingOpen(steps)).toBe(true)
  })

  it('ticks steps from the real state and disappears when all are done', () => {
    expect(onboardingSteps({ companyDone: true, documents: 2, lastBackup: null }).map((s) => s.done)).toEqual([true, true, false])
    expect(onboardingOpen(onboardingSteps({ companyDone: true, documents: 1, lastBackup: '2026-05-01T10:00:00Z' }))).toBe(false)
  })
})

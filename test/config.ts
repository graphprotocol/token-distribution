import { BigNumber, Contract } from 'ethers'

import { Account } from './network'

export enum Revocability {
  NotSet,
  Enabled,
  Disabled,
}

export interface TokenLockSchedule {
  startTime: number
  endTime: number
  periods: number
  revocable: Revocability
  releaseStartTime: number
}
export interface TokenLockParameters {
  owner: string
  beneficiary: string
  token: string
  managedAmount: BigNumber
  startTime: number
  endTime: number
  periods: number
  revocable: Revocability
  releaseStartTime: number
}

export interface DateRange {
  startTime: number
  endTime: number
}

const dateRange = (months: number): DateRange => {
  const date = new Date(+new Date() - 120) // set start time for a few seconds before
  const newDate = new Date().setMonth(date.getMonth() + months)
  return { startTime: Math.round(+date / 1000), endTime: Math.round(+newDate / 1000) }
}

const moveTime = (time: number, months: number) => {
  const date = new Date(time * 1000)
  return Math.round(+date.setMonth(date.getMonth() + months) / 1000)
}

const moveDateRange = (dateRange: DateRange, months: number) => {
  return {
    startTime: moveTime(dateRange.startTime, months),
    endTime: moveTime(dateRange.endTime, months),
  }
}

const createSchedule = (
  startMonths: number,
  durationMonths: number,
  periods: number,
  revocable: Revocability,
  releaseStartTime = 0,
) => {
  return {
    ...moveDateRange(dateRange(durationMonths), startMonths),
    periods,
    revocable,
    releaseStartTime,
  }
}

export const createScheduleScenarios = (): Array<TokenLockSchedule> => {
  return [
    createSchedule(0, 6, 1, Revocability.Disabled), // 6m lock-up + full release + fully vested
    createSchedule(0, 12, 1, Revocability.Disabled), // 12m lock-up + full release  + fully vested
    createSchedule(12, 12, 12, Revocability.Disabled), // 12m lock-up + 1/12 releases  + fully vested
    createSchedule(0, 12, 12, Revocability.Disabled), // no-lockup + 1/12 releases  + fully vested
    createSchedule(-12, 48, 48, Revocability.Enabled), // 1/48 releases + vested + past start + start time override
  ]
}

export const defaultInitArgs = (
  deployer: Account,
  beneficiary: Account,
  token: Contract,
  managedAmount: BigNumber,
): TokenLockParameters => {
  const constantData = {
    owner: deployer.address,
    beneficiary: beneficiary.address,
    token: token.address,
    managedAmount,
  }

  return {
    ...createSchedule(0, 6, 1, Revocability.Disabled),
    ...constantData,
  }
}

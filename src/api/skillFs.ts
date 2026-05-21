import type { SkillFsFile, SkillFolderSelection, SkillPackageReadResult } from '../types/electron'

export const isSkillFsAvailable = () => Boolean(window.novaDesk?.writeSkillPackage)

export const getSkillsRoot = async () => {
  if (!window.novaDesk?.getSkillsRoot) return null
  return window.novaDesk.getSkillsRoot()
}

export const listSkillPackages = async (): Promise<string[]> => {
  if (!window.novaDesk?.listSkillPackages) return []
  return window.novaDesk.listSkillPackages()
}

export const readSkillPackage = async (packageId: string): Promise<SkillPackageReadResult | null> => {
  if (!window.novaDesk?.readSkillPackage) return null
  return window.novaDesk.readSkillPackage(packageId)
}

export const writeSkillPackage = async (packageId: string, files: SkillFsFile[]) => {
  if (!window.novaDesk?.writeSkillPackage) return null
  return window.novaDesk.writeSkillPackage(packageId, files)
}

export const deleteSkillPackage = async (packageId: string) => {
  if (!window.novaDesk?.deleteSkillPackage) return
  await window.novaDesk.deleteSkillPackage(packageId)
}

export const selectSkillFolder = async (): Promise<SkillFolderSelection | null> => {
  if (!window.novaDesk?.selectSkillFolder) return null
  return window.novaDesk.selectSkillFolder()
}

export const revealSkillsRoot = async () => {
  if (!window.novaDesk?.revealSkillsRoot) return null
  return window.novaDesk.revealSkillsRoot()
}

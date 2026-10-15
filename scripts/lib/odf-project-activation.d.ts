export interface ODFProjectActivation {
  schema_version: 1
  enabled: true
  kind: "odoo"
  root: string
  project: string
  initialized_at: string
}

export function readProjectActivation(directory: string): ODFProjectActivation | null
export function isProjectActivated(directory: string): boolean
export function writeProjectActivation(input: { directory: string; project: string; initializedAt?: string }): ODFProjectActivation
export function disableProjectActivation(directory: string): boolean
export function projectActivationPath(directory: string): string

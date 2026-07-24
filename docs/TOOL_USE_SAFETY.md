# Jarvis Tool-Use Safety

Jarvis tools must be explicit, typed, auditable, and approval-aware. The tool-use
framework lives in `src/tools` and is designed for assistant-directed actions
without adding unrestricted shell execution.

## Permission Levels

Every tool declares one permission level:

| Level | Meaning | Approval default |
| --- | --- | --- |
| `read-only` | Reads local app state or local files without changing anything. | No approval required. |
| `reversible-write` | Changes local state in a way Jarvis can undo or restore. | Approval required. |
| `external-network` | Contacts a remote service, publishes data, or sends data outside the machine. | Approval required. |
| `dangerous` | Irreversible, destructive, privileged, credential-bearing, or high-blast-radius action. | Approval required and should remain rare. |

Do not add a generic shell, PowerShell, command prompt, terminal, process-spawn,
or arbitrary script execution tool. If Jarvis needs a capability, build a narrow
tool for that capability with typed inputs, dry-run behavior, audit records, and
clear approval metadata.

## Registry Boundary

`ToolRegistry` registers `ToolDefinition<TInput, TResult>` entries and controls
execution. A tool definition includes:

- stable `id`, title, description, and permission level.
- UI-ready `inputFields`.
- dry-run metadata.
- input and result summarizers for audit records.
- approval request builder.
- a typed executor.

`reversible-write`, `external-network`, and `dangerous` tools cannot run through
the registry unless the caller supplies an approved `ToolApprovalDecision` for
the matching request ID. A first call without approval returns a
`ToolApprovalRequest` instead of performing the action.

## Dry-Run Metadata

Each tool declares whether dry-run is supported, whether it is the default, and
what kind of preview a UI can render:

- `none`
- `text`
- `diff`
- `file-list`
- `network-request`

For write or network tools, prefer `defaultDryRun: true` unless the action is
already blocked by an explicit approval flow and the preview would be misleading.

## Audit Records

Every registry run attempt appends a `ToolAuditRecord` with:

- tool ID, title, and permission level.
- actor (`assistant` or `user`).
- dry-run flag.
- requested and completed timestamps.
- input summary.
- status: `completed`, `dry-run`, `approval-required`, `blocked`, or `failed`.
- result summary, error text, and approval request ID when applicable.

The current sink is `InMemoryToolAuditSink`, capped at the latest 250 records. A
future durable sink should write append-only records to app data and avoid
storing secrets or full file contents in summaries.

## Approval Requests

`ToolApprovalRequest` is shaped for UI rendering:

- title and description.
- permission level.
- proposed action.
- risk summary.
- input summary.
- dry-run availability/default.
- approve and reject button labels.

Approval is not a checkbox hidden in settings. For non-read-only tools, the UI
should show the specific action, risk, and target before allowing it.

## Example Tools

The initial registry exports two harmless local read-only tools:

- `local.listOutputFolder`: lists entries in the configured Jarvis output folder.
- `local.readAppHealth`: reads local configuration health without probing network
  services.

These examples demonstrate the framework shape without broadening Jarvis into a
general automation agent.

## Adding A Tool

1. Define narrow typed input and result shapes.
2. Pick the least permissive permission level that honestly describes the action.
3. Implement dry-run preview behavior.
4. Keep summaries short and free of secrets.
5. Return a specific approval request for every non-read-only action.
6. Add the tool to `jarvisToolRegistry`.
7. Build with `npm.cmd run build`.

If a requested capability cannot be expressed safely without arbitrary command
execution, do not add it to Jarvis.

"use client";

import { FileUp, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TeamMember } from "@/data/types";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  ROSTER_FIELD_SCHEMA,
  ROLE_OPTIONS,
  TALENT_TIER_OPTIONS,
  draftFromForm,
  emptyMemberForm,
  formFromMember,
  parseRosterUploadFile,
  type MemberFormState,
  TEAM_SCOPE_OPTIONS,
  type RosterDraftMember,
  type RosterParseResponse,
  type TeamEntriesResponse,
  type TeamEntry,
} from "@/lib/team-roster";

function MemberFields({
  form,
  setForm,
  idPrefix,
}: {
  form: MemberFormState;
  setForm: React.Dispatch<React.SetStateAction<MemberFormState>>;
  idPrefix: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-hx-muted" htmlFor={`${idPrefix}-name`}>
          Name <span className="text-hx-danger">*</span>
        </label>
        <input
          id={`${idPrefix}-name`}
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-hx-muted" htmlFor={`${idPrefix}-email`}>
          Email <span className="text-hx-danger">*</span>
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-hx-muted" htmlFor={`${idPrefix}-role`}>
            Role
          </label>
          <select
            id={`${idPrefix}-role`}
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-hx-muted" htmlFor={`${idPrefix}-tier`}>
            Level
          </label>
          <select
            id={`${idPrefix}-tier`}
            value={form.talentTier}
            onChange={(e) => setForm((f) => ({ ...f, talentTier: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
          >
            {TALENT_TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-hx-muted" htmlFor={`${idPrefix}-slack`}>
          Slack ID
        </label>
        <input
          id={`${idPrefix}-slack`}
          placeholder="U01234ABCD or @alex"
          value={form.slackId}
          onChange={(e) => setForm((f) => ({ ...f, slackId: e.target.value }))}
          className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 font-mono text-sm text-hx-text focus:border-hx-accent focus:outline-none"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-hx-muted" htmlFor={`${idPrefix}-team`}>
            Scope / team
          </label>
          <input
            id={`${idPrefix}-team`}
            value={form.team}
            onChange={(e) => setForm((f) => ({ ...f, team: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-hx-muted" htmlFor={`${idPrefix}-cap`}>
            Capacity label
          </label>
          <input
            id={`${idPrefix}-cap`}
            value={form.capacity}
            onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-hx-border bg-hx-bg px-3 py-2 text-sm text-hx-text focus:border-hx-accent focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}

function entryToMember(e: TeamEntry): TeamMember {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    role: e.role,
    team: e.team,
    capacity: e.capacity,
    loadPct: e.loadPct,
    utilization: e.utilization,
    status: e.status,
    slackId: e.slackId,
    talentTier: e.talentTier,
    canRemove: e.canRemove,
    isOrgOwner: e.isOrgOwner,
  };
}

function sourceLabel(source: TeamEntry["source"]) {
  if (source === "roster") return "Roster";
  if (source === "ledger") return "Ledger";
  return "Workspace";
}

function RosterEntriesPanel({
  onError,
  onChanged,
  onEditMember,
}: {
  onError: (msg: string) => void;
  onChanged: () => void | Promise<void>;
  onEditMember: (m: TeamMember) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<TeamEntriesResponse>("/api/metrics/teams/entries");
      setEntries(res.entries);
    } catch (ex: unknown) {
      onError(ex instanceof Error ? ex.message : "Failed to load entries");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  async function saveTeam(entry: TeamEntry, team: string) {
    if (!entry.editable || team === entry.team) return;
    setSavingId(entry.id);
    try {
      await apiPatch(`/api/metrics/teams/roster/${encodeURIComponent(entry.id)}`, { team });
      setEntries((list) =>
        list.map((e) => (e.id === entry.id ? { ...e, team } : e)),
      );
      await onChanged();
    } catch (ex: unknown) {
      onError(ex instanceof Error ? ex.message : "Failed to update team");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-hx-muted">Loading roster entries…</p>;
  }

  if (!entries.length) {
    return (
      <p className="py-8 text-center text-sm text-hx-muted">
        No team entries yet. Import a file or add a member manually.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-hx-muted">
        {entries.length} entries in your workspace ({entries.filter((e) => e.editable).length}{" "}
        editable roster row(s)). Ledger owners are read-only here; change scope/team on saved roster
        rows.
      </p>
      <div className="overflow-x-auto rounded-lg border border-hx-border">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-hx-surface-elevated text-hx-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Team / scope</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 w-28 font-medium"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hx-border">
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-hx-surface-elevated/20">
                <td className="px-3 py-2 font-medium text-hx-text">{e.name}</td>
                <td className="px-3 py-2 text-hx-muted">{e.email}</td>
                <td className="px-3 py-2 text-hx-muted">{sourceLabel(e.source)}</td>
                <td className="px-3 py-2">
                  {e.editable ? (
                    <select
                      value={e.team}
                      disabled={savingId === e.id}
                      onChange={(ev) => void saveTeam(e, ev.target.value)}
                      className="w-full max-w-[160px] rounded border border-hx-border bg-hx-bg px-2 py-1 text-hx-text focus:border-hx-accent focus:outline-none"
                      aria-label={`Team for ${e.name}`}
                    >
                      {(TEAM_SCOPE_OPTIONS as readonly string[]).includes(e.team) ? null : (
                        <option value={e.team}>{e.team}</option>
                      )}
                      {TEAM_SCOPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-hx-muted">{e.team}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-hx-muted">{e.role}</td>
                <td className="px-3 py-2 text-right">
                  {e.editable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="text-xs"
                      onClick={() => onEditMember(entryToMember(e))}
                    >
                      <Pencil className="mr-1 size-3" />
                      Edit
                    </Button>
                  ) : (
                    <span className="text-[10px] text-hx-muted">,</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" type="button" onClick={() => void loadEntries()}>
          Refresh list
        </Button>
      </div>
    </div>
  );
}

function SchemaTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-hx-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-hx-surface-elevated/80 text-hx-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Required</th>
            <th className="px-3 py-2 font-medium">Example</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">Accepted headers</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hx-border text-hx-text">
          {ROSTER_FIELD_SCHEMA.map((f) => (
            <tr key={f.key}>
              <td className="px-3 py-2">
                <div className="font-medium">{f.label}</div>
                <div className="text-hx-muted">{f.description}</div>
              </td>
              <td className="px-3 py-2">{f.required ? "Yes" : "No"}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-hx-muted">{f.example}</td>
              <td className="hidden px-3 py-2 text-hx-muted sm:table-cell">
                {f.aliases.slice(0, 4).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamsImportModal({
  open,
  onClose,
  onImported,
  onError,
  onEditMember,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
  onError: (msg: string) => void;
  onEditMember: (m: TeamMember) => void;
}) {
  const [tab, setTab] = useState<"import" | "entries">("import");
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [busy, setBusy] = useState(false);
  const [parseResult, setParseResult] = useState<RosterParseResponse | null>(null);
  const [drafts, setDrafts] = useState<RosterDraftMember[]>([]);
  const [fileLabel, setFileLabel] = useState("");

  const reset = useCallback(() => {
    setTab("import");
    setStep("upload");
    setParseResult(null);
    setDrafts([]);
    setFileLabel("");
    setBusy(false);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setFileLabel(file.name);
    try {
      const payload = await parseRosterUploadFile(file);
      const res = await apiPost<RosterParseResponse>("/api/metrics/teams/roster/parse", payload);
      setParseResult(res);
      const withSelect = (res.members || []).map((m) => ({
        ...m,
        selected: !(m.issues && m.issues.length > 0),
      }));
      setDrafts(withSelect);
      setStep("review");
      if (!withSelect.length) {
        onError("No roster rows found in this file. Check the column headers against the schema.");
      }
    } catch (ex: unknown) {
      onError(ex instanceof Error ? ex.message : "Import parse failed");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(idx: number, patch: Partial<RosterDraftMember>) {
    setDrafts((list) =>
      list.map((m, i) => {
        if (i !== idx) return m;
        const next = { ...m, ...patch };
        const issues: string[] = [];
        if (!next.name.trim()) issues.push("Name is required");
        if (!next.email.trim()) issues.push("Email is required");
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email.trim())) {
          issues.push("Email format looks invalid");
        }
        return { ...next, issues };
      }),
    );
  }

  async function confirmImport() {
    const selected = drafts.filter((d) => d.selected !== false);
    const valid = selected.filter((d) => !d.issues?.length);
    if (!valid.length) {
      onError("Select at least one valid row (name + email).");
      return;
    }
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>("/api/metrics/teams/roster/bulk", {
        members: valid.map(({ name, email, role, team, capacity, slackId, talentTier }) => ({
          name,
          email,
          role,
          team,
          capacity,
          slackId,
          talentTier,
        })),
      });
      await onImported();
      handleClose();
    } catch (ex: unknown) {
      onError(ex instanceof Error ? ex.message : "Bulk import failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        className="scrollbar-hide relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-hx-border bg-hx-surface shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="teams-import-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-hx-border px-6 py-4">
          <div>
            <h2 id="teams-import-title" className="text-lg font-semibold text-hx-text">
              Import & roster
            </h2>
            <p className="mt-1 text-sm text-hx-muted">
              Upload a file or browse all workspace entries and edit team scope on roster rows.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-hx-muted hover:bg-hx-surface-elevated hover:text-hx-text"
            aria-label="Close"
            onClick={handleClose}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-hx-border px-6">
          <button
            type="button"
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === "import"
                ? "border-hx-accent text-hx-accent"
                : "border-transparent text-hx-muted hover:text-hx-text",
            )}
            onClick={() => setTab("import")}
          >
            Import file
          </button>
          <button
            type="button"
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === "entries"
                ? "border-hx-accent text-hx-accent"
                : "border-transparent text-hx-muted hover:text-hx-text",
            )}
            onClick={() => setTab("entries")}
          >
            All entries
          </button>
        </div>

        <div className="scrollbar-hx flex-1 overflow-y-auto px-6 py-4">
          {tab === "entries" ? (
            <RosterEntriesPanel
              onError={onError}
              onChanged={onImported}
              onEditMember={onEditMember}
            />
          ) : null}

          {tab === "import" && step === "upload" && (
            <div className="space-y-4">
              <SchemaTable />
              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-hx-border bg-hx-bg/50 px-6 py-10 transition",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                <FileUp className="size-8 text-hx-accent" />
                <span className="text-sm font-medium text-hx-text">
                  {busy ? "Parsing…" : "Choose .xlsx, .xls, .csv, or .pdf"}
                </span>
                <span className="text-xs text-hx-muted">First sheet / table row should be column headers</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf,application/pdf,text/csv"
                  className="sr-only"
                  disabled={busy}
                  onChange={(ev) => void onFileChange(ev)}
                />
              </label>
            </div>
          )}

          {tab === "import" && step === "review" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-hx-muted">
                <span className="font-medium text-hx-text">{fileLabel}</span>
                <span>·</span>
                <span>{drafts.length} row(s)</span>
                {parseResult?.method && (
                  <>
                    <span>·</span>
                    <span>via {parseResult.method === "llm" ? "AI extraction" : "column mapping"}</span>
                  </>
                )}
                <Button variant="ghost" size="sm" type="button" className="ml-auto" onClick={() => setStep("upload")}>
                  Upload another file
                </Button>
              </div>

              {parseResult?.warnings?.length ? (
                <ul className="rounded-lg border border-hx-warning/40 bg-hx-warning/10 px-3 py-2 text-xs text-hx-warning">
                  {parseResult.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}

              {Object.keys(parseResult?.columnMapping ?? {}).length > 0 && (
                <p className="text-xs text-hx-muted">
                  Mapped columns:{" "}
                  {Object.entries(parseResult!.columnMapping)
                    .map(([k, v]) => `${k}←“${v}”`)
                    .join(", ")}
                </p>
              )}

              <div className="overflow-x-auto rounded-lg border border-hx-border">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-hx-surface-elevated text-hx-muted">
                    <tr>
                      <th className="p-2"> </th>
                      <th className="p-2">Name *</th>
                      <th className="p-2">Email *</th>
                      <th className="p-2">Role</th>
                      <th className="p-2">Team</th>
                      <th className="p-2">Capacity</th>
                      <th className="p-2">Slack</th>
                      <th className="p-2">Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hx-border">
                    {drafts.map((d, i) => (
                      <tr
                        key={`${d.email}-${i}`}
                        className={cn(d.issues?.length && "bg-hx-danger/5")}
                      >
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={d.selected !== false}
                            onChange={(ev) => updateDraft(i, { selected: ev.target.checked })}
                            aria-label={`Include ${d.name || "row"}`}
                          />
                        </td>
                        {(
                          [
                            ["name", d.name],
                            ["email", d.email],
                            ["role", d.role],
                            ["team", d.team],
                            ["capacity", d.capacity],
                            ["slackId", d.slackId ?? ""],
                            ["talentTier", d.talentTier ?? ""],
                          ] as const
                        ).map(([key, val]) => (
                          <td key={key} className="p-1">
                            <input
                              value={val}
                              onChange={(ev) =>
                                updateDraft(i, { [key]: ev.target.value } as Partial<RosterDraftMember>)
                              }
                              className="w-full min-w-[72px] rounded border border-hx-border/60 bg-hx-bg px-1.5 py-1 text-hx-text focus:border-hx-accent focus:outline-none"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {drafts.some((d) => d.issues?.length) && (
                <p className="text-xs text-hx-danger">
                  Rows highlighted in red need name + valid email before import.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-hx-border px-6 py-4">
          <Button variant="outline" type="button" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          {tab === "import" && step === "review" && (
            <Button variant="primary" type="button" disabled={busy} onClick={() => void confirmImport()}>
              {busy ? "Importing…" : `Import ${drafts.filter((d) => d.selected !== false && !d.issues?.length).length} member(s)`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TeamsEditMemberModal({
  member,
  open,
  onClose,
  onSaved,
  onError,
}: {
  member: TeamMember | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<MemberFormState>(emptyMemberForm());
  const [busy, setBusy] = useState(false);

  const canEdit = member?.canRemove === true;

  useEffect(() => {
    if (open && member) setForm(formFromMember(member));
  }, [open, member]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member || !canEdit) return;
    const draft = draftFromForm(form);
    if (!draft.name || !draft.email) return;
    setBusy(true);
    try {
      await apiPatch(`/api/metrics/teams/roster/${encodeURIComponent(member.id)}`, {
        name: draft.name,
        email: draft.email,
        role: draft.role,
        team: draft.team,
        capacity: draft.capacity,
        slackId: draft.slackId,
        talentTier: draft.talentTier,
      });
      await onSaved();
      onClose();
    } catch (ex: unknown) {
      onError(ex instanceof Error ? ex.message : "Failed to update member");
    } finally {
      setBusy(false);
    }
  }

  if (!open || !member) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-hx-border bg-hx-surface p-6 shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-member-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-md p-1 text-hx-muted hover:bg-hx-surface-elevated"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
        <h2 id="edit-member-title" className="flex items-center gap-2 text-lg font-semibold text-hx-text">
          <Pencil className="size-4 text-hx-accent" />
          Edit roster member
        </h2>
        {!canEdit ? (
          <p className="mt-2 text-sm text-hx-muted">
            This row comes from the execution ledger (live owner). Only manually added roster members can be edited here.
            Load and utilization update when that owner appears on ledger work.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-hx-muted">
              Updates your saved roster row. Does not change historical ledger assignments.
            </p>
            <form className="mt-4" onSubmit={submit}>
              <MemberFields form={form} setForm={setForm} idPrefix="edit" />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </>
        )}
        {!canEdit && (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

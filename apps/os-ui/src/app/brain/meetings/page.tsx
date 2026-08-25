"use client";

import { useEffect, useState } from "react";
import { BrainEntityShell, DataTable, EmptyCatalog } from "../_shared";
import { fetchBrainSummary } from "@/lib/api";
import { formatWhen } from "@/lib/live-mappers";

export default function MeetingsPage() {
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);

  useEffect(() => {
    fetchBrainSummary().then((s) => {
      if (!s) {
        setRows([]);
        return;
      }
      setRows(
        s.meetings.map((m) => ({
          meeting: m.title,
          date: formatWhen(m.occurred_at),
          participants: m.attendees || "—",
          topics: "—",
          outcomes: "Ingested",
        })),
      );
    });
  }, []);

  return (
    <BrainEntityShell active="Meetings" newLabel="New Meeting">
      {!rows?.length ? (
        <EmptyCatalog label="meetings" />
      ) : (
        <DataTable
          newLabel="New Meeting"
          rows={rows}
          columns={[
            { key: "meeting", label: "Meeting" },
            { key: "date", label: "Date" },
            { key: "participants", label: "Participants" },
            { key: "topics", label: "Agenda/Topics" },
            { key: "outcomes", label: "Outcomes" },
          ]}
        />
      )}
    </BrainEntityShell>
  );
}

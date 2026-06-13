"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#d4af37", "#4b5563", "#ff4d4d"];

export type TeamsDonutProps = {
  data: { name: string; value: number }[];
};

export function TeamsDonutInner({ data }: TeamsDonutProps) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={72}
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#121212",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

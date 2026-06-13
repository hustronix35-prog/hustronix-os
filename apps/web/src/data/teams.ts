import type { TeamMember } from "./types";

export const teamMetrics = {
  members: 12,
  membersNote: "+1 new this month",
  utilization: 68,
  utilTrend: "↑ 8% vs last 7 days",
  atRisk: 3,
  overCapacity: 2,
};

export const teamMembers: TeamMember[] = [
  {
    id: "1",
    name: "Rohit Verma",
    email: "rohit@acmegrowth.io",
    role: "Founder",
    team: "Leadership",
    capacity: "40h / week",
    loadPct: 72,
    utilization: 92,
    status: "Over Capacity",
  },
  {
    id: "2",
    name: "Arjun Patel",
    email: "arjun@acmegrowth.io",
    role: "Engineering Lead",
    team: "Product",
    capacity: "40h / week",
    loadPct: 55,
    utilization: 68,
    status: "Healthy",
  },
  {
    id: "3",
    name: "Priya Sharma",
    email: "priya@acmegrowth.io",
    role: "PM",
    team: "Product",
    capacity: "40h / week",
    loadPct: 62,
    utilization: 78,
    status: "At Risk",
  },
  {
    id: "4",
    name: "Vikram Singh",
    email: "vikram@acmegrowth.io",
    role: "Ops",
    team: "Operations",
    capacity: "40h / week",
    loadPct: 48,
    utilization: 60,
    status: "Healthy",
  },
  {
    id: "5",
    name: "Neha Kapoor",
    email: "neha@acmegrowth.io",
    role: "Growth",
    team: "Growth",
    capacity: "40h / week",
    loadPct: 70,
    utilization: 88,
    status: "At Risk",
  },
];

export const teamDonut = {
  total: 480,
  used: 326,
  usedPct: 68,
  available: 122,
  availablePct: 25,
  over: 32,
  overPct: 7,
};

export const teamDeptBars = [
  { dept: "Leadership", pct: 92 },
  { dept: "Growth", pct: 88 },
  { dept: "Product", pct: 76 },
  { dept: "Operations", pct: 61 },
  { dept: "Analytics", pct: 54 },
];

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  plan: text("plan").notNull(),
  photo: text("photo").notNull().default(""),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  visits: integer("visits").notNull().default(0),
  stamps: integer("stamps").notNull().default(0),
  lastVisit: text("last_visit"),
  visitHistory: text("visit_history").notNull().default("[]"),
  manualSuspended: integer("manual_suspended", { mode: "boolean" }).notNull().default(false),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  clientName: text("client_name").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
});

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  priceCents: integer("price_cents").notNull().default(0),
  billingType: text("billing_type").notNull().default("unlimited"),
  sessionLimit: integer("session_limit"),
  durationMonths: integer("duration_months").notNull().default(1),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => plans.id),
  planName: text("plan_name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  startsAt: text("starts_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  graceUntil: text("grace_until").notNull(),
  sessionLimit: integer("session_limit"),
  sessionsUsed: integer("sessions_used").notNull().default(0),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  endedAt: text("ended_at"),
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  membershipId: text("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull(),
  voucherPath: text("voucher_path"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  clientName: text("client_name").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
});

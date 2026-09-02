import { openGymDatabase } from "../server/database.mjs";
const db = openGymDatabase();
const result = db.prepare("SELECT COUNT(*) AS count FROM clients").get();
console.log(`Base Monster Gym lista. Clientes: ${result.count}.`);
db.close();

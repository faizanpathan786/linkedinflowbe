"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Load environment variables as early as possible so modules that read
// process.env (like `src/db.ts`) get the correct values.
require("dotenv/config");
const server_1 = __importDefault(require("./server"));
const db_1 = __importDefault(require("./db"));
const scheduler_1 = require("./services/scheduler");
const port = Number(process.env.PORT) || 3000;
server_1.default.listen({
    port,
    host: '0.0.0.0',
}, (err, address) => {
    if (err) {
        server_1.default.log.error(err);
        process.exit(1);
    }
    server_1.default.log.info(`Server running on ${address}`);
    (0, scheduler_1.startScheduler)(server_1.default);
});
function connectDB() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield db_1.default.connect();
            console.log('Connected to Supabase PostgreSQL!');
        }
        catch (err) {
            console.error('Connection error:', err);
        }
    });
}
connectDB();

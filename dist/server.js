"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const autoload_1 = __importDefault(require("@fastify/autoload"));
const node_path_1 = __importDefault(require("node:path"));
const server = (0, fastify_1.default)({
    logger: {
        level: process.env.LOG_LEVEL || 'info',
    },
});
// Register CORS
server.register(require('@fastify/cors'), {
    origin: true,
    credentials: true
});
server.register(autoload_1.default, {
    dir: node_path_1.default.join(__dirname, 'routes'),
});
exports.default = server;

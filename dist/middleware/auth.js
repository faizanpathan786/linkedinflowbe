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
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
const auth_1 = require("../auth");
/**
 * Authentication middleware that checks if the user is authenticated
 * and adds user/session to the request object
 */
function authMiddleware(request, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const session = yield auth_1.auth.api.getSession({
                headers: request.headers,
            });
            if (session) {
                request.user = session.user;
                request.session = session.session;
            }
        }
        catch (error) {
            console.error('Auth middleware error:', error);
            // Don't fail the request, just don't add auth info
        }
    });
}
/**
 * Middleware that requires authentication
 * Use this for protected routes
 */
function requireAuth(request, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const session = yield auth_1.auth.api.getSession({
                headers: request.headers,
            });
            if (!session) {
                return reply.code(401).send({
                    error: 'Authentication required',
                    message: 'You must be logged in to access this resource'
                });
            }
            request.user = session.user;
            request.session = session.session;
        }
        catch (error) {
            console.error('Auth requirement check error:', error);
            return reply.code(500).send({
                error: 'Authentication error',
                message: 'Failed to verify authentication'
            });
        }
    });
}
/**
 * Middleware that requires admin role
 * Use this for admin-only routes
 */
function requireAdmin(request, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        // First check if user is authenticated
        yield requireAuth(request, reply);
        if (reply.sent) {
            return; // Authentication failed
        }
        // Check if user has admin role
        // You'll need to add role field to your user model
        const user = request.user;
        if (!user || user.role !== 'admin') {
            return reply.code(403).send({
                error: 'Admin access required',
                message: 'You must be an admin to access this resource'
            });
        }
    });
}

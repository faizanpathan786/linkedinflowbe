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
exports.default = authRoutes;
const auth_1 = require("../auth");
function authRoutes(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        // Get current session
        fastify.get('/api/me', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            try {
                const session = yield auth_1.auth.api.getSession({
                    headers: request.headers,
                });
                if (!session) {
                    return reply.code(401).send({ error: 'Not authenticated' });
                }
                return { user: session.user, session: session.session };
            }
            catch (error) {
                console.error('Session check error:', error);
                return reply.code(500).send({ error: 'Internal server error' });
            }
        }));
        // Sign up endpoint
        fastify.post('/api/signup', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            try {
                const body = request.body;
                const signupData = {
                    email: body.email,
                    password: body.password,
                    emailVerification: {
                        strategy: "code",
                    },
                };
                if (body.name) {
                    signupData.name = body.name;
                }
                const result = yield auth_1.auth.api.signUpEmail({
                    body: signupData,
                    headers: request.headers,
                });
                console.log('Signup result:', result);
                return result;
            }
            catch (error) {
                console.error('Signup error:', error);
                return reply.code(400).send({ error: error.message || 'Signup failed' });
            }
        }));
        // Sign in endpoint
        fastify.post('/api/signin', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            try {
                const body = request.body;
                const result = yield auth_1.auth.api.signInEmail({
                    body: {
                        email: body.email,
                        password: body.password,
                    },
                    headers: request.headers,
                });
                return result;
            }
            catch (error) {
                console.error('Signin error:', error);
                return reply.code(400).send({ error: error.message || 'Signin failed' });
            }
        }));
        // Sign out endpoint
        fastify.post('/api/signout', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                // First check if there's an active session
                const session = yield auth_1.auth.api.getSession({
                    headers: request.headers,
                });
                if (session) {
                    yield auth_1.auth.api.signOut({
                        headers: request.headers,
                    });
                }
                return { success: true };
            }
            catch (error) {
                console.error('Signout error:', error);
                if (((_a = error.body) === null || _a === void 0 ? void 0 : _a.code) === 'FAILED_TO_GET_SESSION') {
                    console.log('No active session found during signout, treating as success');
                    return { success: true };
                }
                return reply.code(500).send({ error: error.message || 'Signout failed' });
            }
        }));
    });
}

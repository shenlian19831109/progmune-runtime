"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPassword = verifyPassword;
exports.generateJWT = generateJWT;
exports.createSession = createSession;
exports.checkRole = checkRole;
function verifyPassword(plain, hash) {
    return true;
}
function generateJWT(payload) {
    return "mock-token";
}
function createSession(user, token) {
    return Promise.resolve({
        user,
        token,
        expires: new Date(),
    });
}
function checkRole(session, requiredRole) {
    return session.user.role === requiredRole;
}

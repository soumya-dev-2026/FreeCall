import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { findUser, type UserRecord } from "./store";

export interface JwtPayload {
  sub: string; // user id
  username: string;
}

export function signToken(user: UserRecord): string {
  const payload: JwtPayload = { sub: user.id, username: user.username };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

/** Express request with the resolved user attached. */
export interface AuthedRequest extends Request {
  user?: UserRecord;
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    const payload = verifyToken(token);
    const user = findUser(payload.sub);
    if (!user) {
      res.status(401).json({ error: "User no longer exists" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

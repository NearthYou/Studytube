import { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

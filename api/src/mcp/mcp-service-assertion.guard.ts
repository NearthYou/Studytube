import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  McpServiceAssertionVerifier,
  type McpLearningCapability,
  type McpServiceClaims,
} from './mcp-service-assertion';

export type McpAuthenticatedRequest = Request & {
  mcpClaims: McpServiceClaims;
};

@Injectable()
export class McpServiceAssertionGuard implements CanActivate {
  constructor(private readonly verifier: McpServiceAssertionVerifier) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<McpAuthenticatedRequest>();
    const authorization = request.headers.authorization;
    request.mcpClaims = this.verifier.verifyAuthorizationHeader(
      typeof authorization === 'string' ? authorization : undefined,
    );
    return true;
  }
}

export function requireMcpCapability(
  request: McpAuthenticatedRequest,
  capability: McpLearningCapability,
): void {
  if (!request.mcpClaims.capabilities.includes(capability)) {
    throw new ForbiddenException('MCP capability rejected');
  }
}

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class WorkflowTokenGuard implements CanActivate {
    constructor(private configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const token = request.headers.authorization;
        
        if (!token) {
            throw new UnauthorizedException('Missing or invalid authorization header');
        }
        
        const expectedToken = this.configService.get<string>("GHL_WORKFLOW_TOKEN");
        
        if (!expectedToken) {
            throw new UnauthorizedException('Workflow token not configured');
        }
        
        if (token !== expectedToken) {
            throw new UnauthorizedException('Invalid workflow token');
        }
        
        return true;
    }
}
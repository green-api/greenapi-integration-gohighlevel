import { IsString, IsNotEmpty } from 'class-validator';

export class GhlOAuthCallbackDto {
    @IsString()
    @IsNotEmpty()
    code: string;
}

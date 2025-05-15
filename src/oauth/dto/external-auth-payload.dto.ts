import { IsString, IsNotEmpty, IsOptional, IsArray, ArrayMinSize, IsBoolean } from "class-validator";

export class GhlExternalAuthPayloadDto {
  @IsString()
  @IsNotEmpty()
  instance_id: string;

  @IsString()
  @IsNotEmpty()
  api_token_instance: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @IsNotEmpty()
  locationId: string[];

  @IsString()
  @IsOptional()
  companyId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  excludedLocations?: string[];

  @IsBoolean()
  @IsOptional()
  approveAllLocations?: boolean;
}

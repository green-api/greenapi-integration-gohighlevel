import { IsObject } from "class-validator";

export class WorkflowActionDto {
	@IsObject()
	data: {
		instanceId: string;
		[key: string]: any;
	};

	@IsObject()
	extras: {
		locationId: string;
		contactId: string;
		[key: string]: any;
	};

	@IsObject()
	meta: {
		key: string;
		version: string;
		[key: string]: any;
	};
}
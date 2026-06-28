import {
  IsEnum, IsString, IsOptional, IsDateString,
  ValidateIf, MinLength,
} from 'class-validator';

export enum LeaveType {
  ANNUAL = 'ANNUAL',
  SICK   = 'SICK',
  UNPAID = 'UNPAID',
}

export class CreateLeaveRequestDto {
  @IsString()
  employeeId!: string;

  @IsEnum(LeaveType, {
    message: 'leaveType must be ANNUAL, SICK, or UNPAID',
  })
  leaveType!: LeaveType;

  @IsDateString({}, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @IsDateString({}, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  // WHY @ValidateIf instead of @IsOptional?
  // reason is optional for ANNUAL but REQUIRED for SICK/UNPAID.
  // @ValidateIf says "only run this validation when the condition is true"
  @ValidateIf((o) => o.leaveType === 'SICK' || o.leaveType === 'UNPAID')
  @IsString()
  @MinLength(1, { message: 'reason is required for SICK and UNPAID leave' })
  reason?: string;
}

export class RejectLeaveRequestDto {
  @IsString()
  @MinLength(1, { message: 'comment is required' })
  comment!: string;
}

export class ListLeaveRequestsDto {
  @IsOptional()
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  employeeId?: string;
}
import { Controller, Get, Param, Headers, BadRequestException } from '@nestjs/common';
import { LeaveRequestService } from '../leave-request/leave-request.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly leaveRequestService: LeaveRequestService) {}

  @Get(':employeeId/leave-balance')
  async getBalance(
    @Headers('x-tenant-id') tenantId: string,
    @Param('employeeId') employeeId: string,
  ) {
    if (!tenantId) throw new BadRequestException('X-Tenant-Id header is required');
    return this.leaveRequestService.getLeaveBalance(tenantId, employeeId);
  }
}
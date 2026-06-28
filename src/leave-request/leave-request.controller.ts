import {
  Controller, Post, Get, Body, Param, Headers,
  Query, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';
import {
  CreateLeaveRequestDto, RejectLeaveRequestDto, ListLeaveRequestsDto,
} from './dto/leave-request.dto';

@Controller('leave-requests')
export class LeaveRequestController {
  constructor(private readonly leaveRequestService: LeaveRequestService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Headers('x-tenant-id') tenantId: string,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    this.requireTenantId(tenantId);
    return this.leaveRequestService.submitLeave(tenantId, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-approver-id') approverId: string,
    @Param('id') requestId: string,
  ) {
    this.requireTenantId(tenantId);
    if (!approverId) throw new BadRequestException('X-Approver-Id header is required');
    return this.leaveRequestService.approveLeave(tenantId, requestId, approverId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-approver-id') rejectorId: string,
    @Param('id') requestId: string,
    @Body() dto: RejectLeaveRequestDto,
  ) {
    this.requireTenantId(tenantId);
    if (!rejectorId) throw new BadRequestException('X-Approver-Id header is required');
    return this.leaveRequestService.rejectLeave(tenantId, requestId, rejectorId, dto);
  }

  @Get()
  async list(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: ListLeaveRequestsDto,
  ) {
    this.requireTenantId(tenantId);
    return this.leaveRequestService.listLeaveRequests(tenantId, {
      status:     query.status,
      employeeId: query.employeeId,
    });
  }

  private requireTenantId(tenantId: string) {
    if (!tenantId) throw new BadRequestException('X-Tenant-Id header is required');
  }
}
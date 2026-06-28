import {
  Injectable, BadRequestException, NotFoundException,
  ConflictException, UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveRequestDto, LeaveType, RejectLeaveRequestDto } from './dto/leave-request.dto';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class LeaveRequestService {
  constructor(private readonly prisma: PrismaService) {}

  private countDays(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end   = new Date(endDate);
    return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  }

  async submitLeave(tenantId: string, dto: CreateLeaveRequestDto) {
    const { employeeId, leaveType, startDate, endDate, reason } = dto;

    if (new Date(endDate) < new Date(startDate)) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (new Date(endDate) < today) {
      throw new BadRequestException('Cannot submit leave for dates entirely in the past');
    }

    const days = this.countDays(startDate, endDate);

    if (leaveType === LeaveType.SICK && days > 3) {
      if (!reason || reason.trim().length < 20) {
        throw new BadRequestException(
          'SICK leave longer than 3 days requires a reason of at least 20 characters',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {

      const employee = await tx.employee.findFirst({
        where: { id: employeeId, tenantId },
      });
      if (!employee) {
        throw new NotFoundException(`Employee ${employeeId} not found`);
      }

      const overlap = await tx.leaveRequest.findFirst({
        where: {
          employeeId,
          tenantId,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: new Date(endDate) },
          endDate:   { gte: new Date(startDate) },
        },
      });
      if (overlap) {
        throw new ConflictException(
          'Employee already has a PENDING or APPROVED leave overlapping these dates',
        );
      }

      if (leaveType === LeaveType.ANNUAL) {
        if (new Decimal(employee.annualLeaveBalance).lessThan(days)) {
          throw new UnprocessableEntityException(
            `Insufficient annual leave balance. Requested: ${days} days, Available: ${employee.annualLeaveBalance}`,
          );
        }
      }

      return tx.leaveRequest.create({
        data: {
          tenantId,
          employeeId,
          leaveType,
          startDate:    new Date(startDate),
          endDate:      new Date(endDate),
          daysRequested: days,
          reason:       reason ?? null,
          status:       'PENDING',
        },
      });
    });
  }

  async approveLeave(tenantId: string, requestId: string, approverId: string) {
    return this.prisma.$transaction(async (tx) => {

      const result = await tx.leaveRequest.updateMany({
        where: {
          id:       requestId,
          tenantId: tenantId,
          status:   'PENDING',     
        },
        data: {
          status:      'APPROVED',
          approvedById: approverId,
          approvedAt:  new Date(),
        },
      });

      if (result.count === 0) {
        const existing = await tx.leaveRequest.findFirst({
          where: { id: requestId, tenantId },
        });
        if (!existing) throw new NotFoundException('Leave request not found');

        throw new ConflictException(`Leave request is already ${existing.status}`);
      }

      const leaveRequest = await tx.leaveRequest.findUniqueOrThrow({
        where: { id: requestId },
      });

      if (leaveRequest.leaveType === 'ANNUAL') {

        const deductResult = await tx.employee.updateMany({
          where: {
            id:                   leaveRequest.employeeId,
            tenantId:             tenantId,
            annualLeaveBalance:   { gte: leaveRequest.daysRequested },
          },
          data: {
            annualLeaveBalance: {
              decrement: leaveRequest.daysRequested,
            },
          },
        });

        if (deductResult.count === 0) {
          throw new UnprocessableEntityException('Insufficient annual leave balance');
        }
      }

      return leaveRequest;
    });
  }

  async rejectLeave(
    tenantId:   string,
    requestId:  string,
    rejectorId: string,
    dto:        RejectLeaveRequestDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.leaveRequest.updateMany({
        where: {
          id:       requestId,
          tenantId: tenantId,
          status:   'PENDING',
        },
        data: {
          status:           'REJECTED',
          rejectionComment: dto.comment,
          rejectedById:     rejectorId,
          rejectedAt:       new Date(),
        },
      });

      if (result.count === 0) {
        const existing = await tx.leaveRequest.findFirst({
          where: { id: requestId, tenantId },
        });
        if (!existing) throw new NotFoundException('Leave request not found');
        throw new ConflictException(`Leave request is already ${existing.status}`);
      }

      return tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
  }

  async listLeaveRequests(
    tenantId: string,
    filters: { status?: string; employeeId?: string },
  ) {
    return this.prisma.leaveRequest.findMany({
      where: {
        tenantId,
        ...(filters.status     && { status:     filters.status as any }),
        ...(filters.employeeId && { employeeId: filters.employeeId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLeaveBalance(tenantId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: {
        id:                 true,
        name:               true,
        annualLeaveBalance: true,
      },
    });

    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);

    return {
      employeeId:          employee.id,
      name:                employee.name,
      annualLeaveBalance:  Number(employee.annualLeaveBalance),
    };
  }
}
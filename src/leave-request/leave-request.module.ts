import { Module } from '@nestjs/common';
import { LeaveRequestController } from './leave-request.controller';
import { LeaveRequestService } from './leave-request.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [LeaveRequestController],
  providers:   [LeaveRequestService, PrismaService],
  exports:     [LeaveRequestService],
})
export class LeaveRequestModule {}
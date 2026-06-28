import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { LeaveRequestModule } from 'src/leave-request/leave-request.module';

@Module({
  imports:     [LeaveRequestModule],
  controllers: [EmployeesController],
})
export class EmployeesModule {}
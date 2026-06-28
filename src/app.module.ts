import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LeaveRequestController } from './leave-request/leave-request.controller';
import { LeaveRequestService } from './leave-request/leave-request.service';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { EmployeesModule } from './employees/employees.module';
import { LeaveRequestModule } from './leave-request/leave-request.module';
import { PrismaService } from './prisma/prisma.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ ConfigModule.forRoot({
      isGlobal: true,
    }),EmployeesModule, LeaveRequestModule],
  controllers: [AppController, LeaveRequestController, EmployeesController],
  providers: [AppService, LeaveRequestService, EmployeesService, PrismaService],
})
export class AppModule {}

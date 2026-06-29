import { Test, TestingModule } from '@nestjs/testing';
import { EmployeesController } from './employees.controller';
import { LeaveRequestService } from '../leave-request/leave-request.service';

describe('EmployeesController', () => {
  let controller: EmployeesController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [EmployeesController],
      providers: [
        {
          provide: LeaveRequestService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get(EmployeesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
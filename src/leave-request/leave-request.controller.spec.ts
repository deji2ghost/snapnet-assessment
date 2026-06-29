import { Test, TestingModule } from '@nestjs/testing';
import { LeaveRequestController } from './leave-request.controller';
import { LeaveRequestService } from './leave-request.service';

describe('LeaveRequestController', () => {
  let controller: LeaveRequestController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [LeaveRequestController],
      providers: [
        {
          provide: LeaveRequestService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get(LeaveRequestController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

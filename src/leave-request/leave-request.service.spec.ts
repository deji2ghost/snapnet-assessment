import { Test, TestingModule } from '@nestjs/testing';
import { LeaveRequestService } from './leave-request.service';
import { LeaveType } from './dto/leave-request.dto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ─────────────────────────────────────────────────────────────────────────────
// WHY TWO SEPARATE MOCK OBJECTS (mockTx and mockPrisma)?
//
// Inside a $transaction, the service receives `tx` as the argument and calls
// tx.leaveRequest / tx.employee on it — NOT this.prisma directly.
// So we need mockTx for everything inside transactions.
//
// listLeaveRequests and getLeaveBalance do NOT use a transaction, so they call
// this.prisma.leaveRequest / this.prisma.employee directly — those go on mockPrisma.
// ─────────────────────────────────────────────────────────────────────────────

const mockTx = {
  leaveRequest: {
    findFirst:         jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create:            jest.fn(),
    updateMany:        jest.fn(),
  },
  employee: {
    findFirst:  jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn((cb) => cb(mockTx)),
  leaveRequest: { findMany: jest.fn() },
  employee:     { findFirst: jest.fn() },
};

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID   = 'tenant-001';
const EMPLOYEE_ID = 'emp-001';
const REQUEST_ID  = 'req-001';
const APPROVER_ID = 'manager-001';

// dec() creates a numeric object that behaves like Prisma's Decimal.
// Number(dec(3)) = 3 because Number() calls valueOf() automatically.
const dec = (n: number) => ({
  valueOf:  () => n,
  toString: () => String(n),
  lessThan: (x: number) => n < x,
  gte:      (x: number) => n >= x,
});

const mockEmployee = {
  id:                 EMPLOYEE_ID,
  tenantId:           TENANT_ID,
  name:               'Ada Test',
  annualLeaveBalance: dec(20),
};

const mockPendingRequest = {
  id:               REQUEST_ID,
  tenantId:         TENANT_ID,
  employeeId:       EMPLOYEE_ID,
  leaveType:        'ANNUAL',
  startDate:        new Date('2027-08-01'),
  endDate:          new Date('2027-08-05'),
  daysRequested:    dec(5),
  reason:           null,
  status:           'PENDING',
  approvedById:     null,
  approvedAt:       null,
  rejectionComment: null,
  rejectedById:     null,
  rejectedAt:       null,
  createdAt:        new Date(),
  updatedAt:        new Date(),
};

// ── Suite ────────────────────────────────────────────────────────────────────

describe('LeaveRequestService', () => {
  let service: LeaveRequestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveRequestService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LeaveRequestService>(LeaveRequestService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Re-wire after clearAllMocks, which wipes mockImplementation too
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
  });

  // ── submitLeave ────────────────────────────────────────────────────────────

  describe('submitLeave', () => {

    it('TEST 1 — submits a valid ANNUAL leave request successfully', async () => {
      mockTx.employee.findFirst.mockResolvedValue(mockEmployee);
      mockTx.leaveRequest.findFirst.mockResolvedValue(null);
      mockTx.leaveRequest.create.mockResolvedValue(mockPendingRequest);

      const result = await service.submitLeave(TENANT_ID, {
        employeeId: EMPLOYEE_ID,
        leaveType:  LeaveType.ANNUAL,
        startDate:  '2027-08-01',
        endDate:    '2027-08-05',
      });

      expect(result.status).toBe('PENDING');
      expect(mockTx.leaveRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leaveType:     'ANNUAL',
            status:        'PENDING',
            daysRequested: 5,
          }),
        }),
      );
    });

    it('TEST 2 — rejects when endDate is before startDate', async () => {
      await expect(
        service.submitLeave(TENANT_ID, {
          employeeId: EMPLOYEE_ID,
          leaveType:  LeaveType.ANNUAL,
          startDate:  '2027-08-10',
          endDate:    '2027-08-01',
        }),
      ).rejects.toThrow('endDate must be on or after startDate');
    });

    it('TEST 3 — rejects leave entirely in the past', async () => {
      await expect(
        service.submitLeave(TENANT_ID, {
          employeeId: EMPLOYEE_ID,
          leaveType:  LeaveType.ANNUAL,
          startDate:  '2020-01-01',
          endDate:    '2020-01-05',
        }),
      ).rejects.toThrow('entirely in the past');
    });

    it('TEST 4 — rejects overlapping PENDING or APPROVED leave', async () => {
      mockTx.employee.findFirst.mockResolvedValue(mockEmployee);
      mockTx.leaveRequest.findFirst.mockResolvedValue({ id: 'existing-req' });

      await expect(
        service.submitLeave(TENANT_ID, {
          employeeId: EMPLOYEE_ID,
          leaveType:  LeaveType.ANNUAL,
          startDate:  '2027-08-01',
          endDate:    '2027-08-05',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockTx.leaveRequest.create).not.toHaveBeenCalled();
    });

    it('TEST 5 — rejects ANNUAL leave that exceeds the remaining balance', async () => {
      mockTx.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        annualLeaveBalance: dec(3), // only 3 days left
      });
      mockTx.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.submitLeave(TENANT_ID, {
          employeeId: EMPLOYEE_ID,
          leaveType:  LeaveType.ANNUAL,
          startDate:  '2027-08-01',
          endDate:    '2027-08-10', // 10 days requested
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      await expect(
        service.submitLeave(TENANT_ID, {
          employeeId: EMPLOYEE_ID,
          leaveType:  LeaveType.ANNUAL,
          startDate:  '2027-08-01',
          endDate:    '2027-08-10',
        }),
      ).rejects.toThrow('Insufficient annual leave balance');
    });

    it('TEST 6 — rejects SICK leave over 3 days with a short reason', async () => {
      await expect(
        service.submitLeave(TENANT_ID, {
          employeeId: EMPLOYEE_ID,
          leaveType:  LeaveType.SICK,
          startDate:  '2027-08-01',
          endDate:    '2027-08-07', // 7 days
          reason:     'Too short',  // only 9 chars
        }),
      ).rejects.toThrow('at least 20 characters');
    });

    it('TEST 7 — accepts SICK leave over 3 days with a 20+ character reason', async () => {
      mockTx.employee.findFirst.mockResolvedValue(mockEmployee);
      mockTx.leaveRequest.findFirst.mockResolvedValue(null);
      mockTx.leaveRequest.create.mockResolvedValue({
        ...mockPendingRequest,
        leaveType: 'SICK',
        reason:    'Recovering from surgery procedure',
      });

      const result = await service.submitLeave(TENANT_ID, {
        employeeId: EMPLOYEE_ID,
        leaveType:  LeaveType.SICK,
        startDate:  '2027-08-01',
        endDate:    '2027-08-07',
        reason:     'Recovering from surgery procedure',
      });

      expect(result.leaveType).toBe('SICK');
      expect(mockTx.leaveRequest.create).toHaveBeenCalledTimes(1);
    });

    it('TEST 8 — returns 404 when employee does not exist', async () => {
      mockTx.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.submitLeave(TENANT_ID, {
          employeeId: 'ghost-id',
          leaveType:  LeaveType.ANNUAL,
          startDate:  '2027-08-01',
          endDate:    '2027-08-05',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockTx.leaveRequest.findFirst).not.toHaveBeenCalled();
      expect(mockTx.leaveRequest.create).not.toHaveBeenCalled();
    });

  });

  // ── approveLeave ───────────────────────────────────────────────────────────

  describe('approveLeave', () => {

    it('TEST 9 — approves a PENDING request and deducts ANNUAL balance', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
      mockTx.leaveRequest.findUniqueOrThrow.mockResolvedValue(mockPendingRequest);
      mockTx.employee.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approveLeave(TENANT_ID, REQUEST_ID, APPROVER_ID);

      expect(result.id).toBe(REQUEST_ID);
      expect(mockTx.leaveRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
          data:  expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
      expect(mockTx.employee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            annualLeaveBalance: { decrement: mockPendingRequest.daysRequested },
          }),
        }),
      );
    });

    it('TEST 10 — does NOT deduct balance for SICK leave approval', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
      mockTx.leaveRequest.findUniqueOrThrow.mockResolvedValue({
        ...mockPendingRequest,
        leaveType: 'SICK',
      });

      await service.approveLeave(TENANT_ID, REQUEST_ID, APPROVER_ID);

      expect(mockTx.employee.updateMany).not.toHaveBeenCalled();
    });

    it('TEST 11 — returns 409 on duplicate approval (idempotency guard)', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
      mockTx.leaveRequest.findFirst.mockResolvedValue({ status: 'APPROVED' });

      await expect(
        service.approveLeave(TENANT_ID, REQUEST_ID, APPROVER_ID),
      ).rejects.toThrow('already APPROVED');

      expect(mockTx.employee.updateMany).not.toHaveBeenCalled();
    });

    it('TEST 12 — returns 404 when leave request does not exist', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
      mockTx.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.approveLeave(TENANT_ID, 'nonexistent-id', APPROVER_ID),
      ).rejects.toThrow(NotFoundException);
    });

  });

  // ── rejectLeave ────────────────────────────────────────────────────────────

  describe('rejectLeave', () => {

    it('TEST 13 — rejects a PENDING request with a comment', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
      mockTx.leaveRequest.findUniqueOrThrow.mockResolvedValue({
        ...mockPendingRequest,
        status:           'REJECTED',
        rejectionComment: 'Not approved',
      });

      const result = await service.rejectLeave(
        TENANT_ID, REQUEST_ID, APPROVER_ID, { comment: 'Not approved' },
      );

      expect(result.status).toBe('REJECTED');
      expect(mockTx.leaveRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
          data:  expect.objectContaining({
            status:           'REJECTED',
            rejectionComment: 'Not approved',
          }),
        }),
      );
    });

    it('TEST 14 — returns 409 when trying to reject an already-rejected request', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
      mockTx.leaveRequest.findFirst.mockResolvedValue({ status: 'REJECTED' });

      await expect(
        service.rejectLeave(TENANT_ID, REQUEST_ID, APPROVER_ID, { comment: 'Again' }),
      ).rejects.toThrow('already REJECTED');
    });

    it('TEST 15 — returns 409 when trying to reject an already-approved request', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
      mockTx.leaveRequest.findFirst.mockResolvedValue({ status: 'APPROVED' });

      await expect(
        service.rejectLeave(TENANT_ID, REQUEST_ID, APPROVER_ID, { comment: 'Too late' }),
      ).rejects.toThrow('already APPROVED');
    });

    it('TEST 16 — returns 404 when request does not exist', async () => {
      mockTx.leaveRequest.updateMany.mockResolvedValue({ count: 0 });
      mockTx.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.rejectLeave(TENANT_ID, 'bad-id', APPROVER_ID, { comment: 'Comment' }),
      ).rejects.toThrow(NotFoundException);
    });

  });

  // ── listLeaveRequests ──────────────────────────────────────────────────────

  describe('listLeaveRequests', () => {

    it('TEST 17 — returns all requests sorted by createdAt desc', async () => {
      mockPrisma.leaveRequest.findMany.mockResolvedValue([mockPendingRequest]);

      const result = await service.listLeaveRequests(TENANT_ID, {});

      expect(result).toHaveLength(1);
      expect(mockPrisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where:   { tenantId: TENANT_ID },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('TEST 18 — filters by status when provided', async () => {
      mockPrisma.leaveRequest.findMany.mockResolvedValue([]);

      await service.listLeaveRequests(TENANT_ID, { status: 'PENDING' });

      expect(mockPrisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, status: 'PENDING' },
        }),
      );
    });

    it('TEST 19 — filters by employeeId when provided', async () => {
      mockPrisma.leaveRequest.findMany.mockResolvedValue([mockPendingRequest]);

      await service.listLeaveRequests(TENANT_ID, { employeeId: EMPLOYEE_ID });

      expect(mockPrisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, employeeId: EMPLOYEE_ID },
        }),
      );
    });

  });

  // ── getLeaveBalance ────────────────────────────────────────────────────────

  describe('getLeaveBalance', () => {

    it('TEST 20 — returns the correct balance for a valid employee', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id:                 EMPLOYEE_ID,
        name:               'Ada Test',
        annualLeaveBalance: dec(20),
      });

      const result = await service.getLeaveBalance(TENANT_ID, EMPLOYEE_ID);

      expect(result).toEqual({
        employeeId:         EMPLOYEE_ID,
        name:               'Ada Test',
        annualLeaveBalance: 20,
      });
    });

    it('TEST 21 — returns 404 for an unknown employee', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.getLeaveBalance(TENANT_ID, 'ghost-id'),
      ).rejects.toThrow(NotFoundException);
    });

  });

});
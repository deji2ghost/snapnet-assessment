import { PrismaClient } from 'generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  }),
});

const TENANT_ID   = '00000000-0000-0000-0000-000000000001';
const EMPLOYEE_1  = '00000000-0000-0000-0000-000000000010';
const EMPLOYEE_2  = '00000000-0000-0000-0000-000000000011';
const MANAGER_ID  = '00000000-0000-0000-0000-000000000020';

async function main() {
  // upsert = insert if not exists, update if exists
  // This means you can run the seed multiple times safely
  await prisma.employee.upsert({
    where: { id: EMPLOYEE_1 },
    update: {},
    create: {
      id: EMPLOYEE_1,
      tenantId: TENANT_ID,
      name: 'Ada Okafor',
      email: 'ada@acme.com',
      role: 'EMPLOYEE',
      annualLeaveBalance: 20,
    },
  });

  await prisma.employee.upsert({
    where: { id: EMPLOYEE_2 },
    update: {},
    create: {
      id: EMPLOYEE_2,
      tenantId: TENANT_ID,
      name: 'Bayo Adeyemi',
      email: 'bayo@acme.com',
      role: 'EMPLOYEE',
      annualLeaveBalance: 15,
    },
  });

  await prisma.employee.upsert({
    where: { id: MANAGER_ID },
    update: {},
    create: {
      id: MANAGER_ID,
      tenantId: TENANT_ID,
      name: 'Chidi Musa',
      email: 'chidi@acme.com',
      role: 'MANAGER',
      annualLeaveBalance: 20,
    },
  });

  console.log('✅ Seeded:');
  console.log(`   Tenant:     ${TENANT_ID}`);
  console.log(`   Employee 1: ${EMPLOYEE_1}  (Ada, 20 days)`);
  console.log(`   Employee 2: ${EMPLOYEE_2}  (Bayo, 15 days)`);
  console.log(`   Manager:    ${MANAGER_ID}  (Chidi)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
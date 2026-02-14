import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  // Internal endpoint for plate-service to sync known plates
  const syncHeader = req.headers.get('x-plate-sync');
  if (!syncHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return all license plates across all orgs (plate-service is internal)
  const plates = await prisma.licensePlate.findMany({
    select: {
      number: true,
      type: true,
    },
  });

  return NextResponse.json(plates);
}

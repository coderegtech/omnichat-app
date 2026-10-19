import { PrismaClient } from '@omnichat/database';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config=loadConfig();
const db=new PrismaClient();
await db.$connect();
// One API replica is supported by the supplied deployment. Never replay paid work.
await db.message.updateMany({where:{status:{in:['streaming','pending']},role:'assistant'},data:{status:'error',error:'The API restarted before completion. Saved partial text is retained.'}});
await db.generationJob.updateMany({where:{status:{in:['running','queued']}},data:{status:'failed',error:'The API restarted before completion. The generation was not retried.'}});
await db.session.deleteMany({where:{expiresAt:{lt:new Date()}}});
await db.codingRun.updateMany({where:{status:'running'},data:{status:'error',error:'The API restarted before this coding run completed. No changes were applied.'}});
const app=await buildApp({db,config});
const stop=async()=>{await app.close();await db.$disconnect();process.exit(0);};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
await app.listen({port:config.port,host:config.host});

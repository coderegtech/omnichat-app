import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@omnichat/database';
import type { AppConfig } from './config.js';

const cost={N:32768,r:8,p:1,maxmem:64*1024*1024};
const scryptAsync=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,cost,(error,key)=>error?reject(error):resolve(key)));
export async function hashPassword(password:string):Promise<string> {
  const salt=randomBytes(16).toString('hex');
  const hash=await scryptAsync(password,salt);
  return `scrypt$32768$8$1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password:string,encoded:string):Promise<boolean> {
  const parts=encoded.split('$');
  if(parts.length!==6 || parts[0]!=='scrypt' || parts[1]!=='32768' || parts[2]!=='8' || parts[3]!=='1') return false;
  const expected=Buffer.from(parts[5]!, 'hex');
  const actual=await scryptAsync(password,parts[4]!);
  return expected.length===actual.length && timingSafeEqual(actual,expected);
}
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export class HttpError extends Error { constructor(public statusCode:number,public code:string,message:string){super(message);} }
export async function authenticate(request:FastifyRequest,db:PrismaClient) {
  const bearer=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const token=bearer ?? request.cookies.omnichat_session;
  if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401,'UNAUTHENTICATED','Sign in to continue.');
  const session=await db.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!session || session.expiresAt < new Date()) throw new HttpError(401,'UNAUTHENTICATED','Your session expired. Sign in again.');
  return session;
}
export async function issueSession(db:PrismaClient,reply:FastifyReply,userId:string,native:boolean,config:AppConfig) {
  const token=randomBytes(32).toString('base64url');
  const expiresAt=new Date(Date.now()+config.sessionDays*86400000);
  await db.session.create({data:{userId,tokenHash:tokenHash(token),expiresAt}});
  if(!native) reply.setCookie('omnichat_session',token,{httpOnly:true,secure:config.cookieSecure,sameSite:'lax',path:'/',expires:expiresAt});
  return native?token:undefined;
}
export function checkOrigin(request:FastifyRequest,config:AppConfig) {
  if(['GET','HEAD','OPTIONS'].includes(request.method)) return;
  const origin=request.headers.origin;
  if(origin && !config.origins.includes(origin)) throw new HttpError(403,'ORIGIN_REJECTED','This request origin is not allowed.');
  if(request.headers.authorization?.startsWith('Bearer ')) return;
  const body=request.body as {client?:unknown}|undefined;
  const nativeAuth=/^\/api\/auth\/(register|login)(?:\?|$)/.test(request.url) && body?.client==='native' && !request.cookies.omnichat_session;
  if(!origin && nativeAuth) return;
  if(!origin || !config.origins.includes(origin)) throw new HttpError(403,'ORIGIN_REQUIRED','Browser requests must include an allowed Origin.');
}

import {ApiClient} from '@omnichat/api-client';
export const api = new ApiClient({baseUrl:'/api'});
export function errorMessage(error:unknown):string {return error instanceof Error ? error.message : 'Something went wrong. Please try again.';}

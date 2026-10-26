/** Replaced by the Safari build with its native transport. Chrome keeps its existing storage. */
export async function prepareHost():Promise<void>{}
export async function nativeCommand(_kind:string,_payload?:unknown):Promise<any>{throw new Error("Native services are unavailable on this platform");}

type Identity = {authorId:string;skillId:string};
/** Only a saved identity or a reviewed bundled publisher pin may suggest an
 * update. An unlinked local override still needs the explicit link/update UI. */
export function catalogUpdateIdentity(name:string,user:{identity?:Identity}|null|undefined,pins:Record<string,Identity>):Identity|undefined {
  if(user?.identity)return user.identity;
  return Object.hasOwn(pins,name)?pins[name]:undefined;
}

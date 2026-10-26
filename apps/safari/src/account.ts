import {nativeCommand} from "@/shared/platformBridge";
export type {LoginState} from "../../chrome/src/background/account";
export const getFreshAccount=()=>nativeCommand("account");
export const refreshTokens=()=>nativeCommand("account",{refresh:true});
export const getLoginState=()=>nativeCommand("login-state");
export const startLogin=(email?:string)=>nativeCommand("login-start",{email});
export const cancelLogin=()=>nativeCommand("login-cancel");
export const pollOnce=()=>nativeCommand("login-poll");
export const logout=()=>nativeCommand("logout");

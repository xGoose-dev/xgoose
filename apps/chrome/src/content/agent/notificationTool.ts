import {z} from "zod";
import {defineTool} from "@xgoose/core";
import {send} from "@/shared/messages";
export function createNotificationTool(runId:string,tabId?:number) {
  return defineTool({
    name:"emit_notification",
    description:"Send one browser notification for this task when the user should be alerted. Notifications are enabled by the user. Keep the message brief and omit sensitive details.",
    inputSchema:z.object({title:z.string().trim().min(1).max(80),message:z.string().trim().min(1).max(240)}),
    label:()=>"Notify user",
    execute:(input)=>send("sw:notification_emit",{...input,mode:"explicit",runId,tabId}),
  });
}

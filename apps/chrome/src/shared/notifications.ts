export const NOTIFICATIONS_KEY="xgoose.notifications.enabled";
export interface NotificationRequest {
  mode:"explicit"|"completion";
  runId:string;
  tabId?:number;
  title?:string;
  message?:string;
}
export interface NotificationReceipt {
  sent:boolean;
  reason:"sent"|"disabled"|"permission_denied"|"active"|"duplicate"|"unavailable";
  notificationId?:string;
  title?:string;
  message?:string;
}

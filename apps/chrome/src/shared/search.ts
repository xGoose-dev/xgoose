export interface SearchReply {
  provider:"exa";
  results:Array<{title?:string;url:string;publishedDate?:string;highlights?:string[]}>;
  charged_micros:number;
}

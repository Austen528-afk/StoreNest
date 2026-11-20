'use strict';
const {ApiError,MAX_IMAGE}=require('./storage.cjs');
function decodeImage(encoded,type){
 if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_IMAGE/3)*4||!encoded.length||/[^A-Za-z0-9+/=]/.test(encoded))throw new ApiError(400,'Invalid or oversized image data.');
 const bytes=Buffer.from(encoded,'base64');
 if(!bytes.length||bytes.length>MAX_IMAGE||bytes.toString('base64')!==encoded)throw new ApiError(400,'Invalid or oversized image data.');
 const ascii=(a,b)=>bytes.toString('ascii',a,b);
 const png=bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&ascii(12,16)==='IHDR';
 const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 const webp=bytes.length>=16&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
 const gif=bytes.length>=14&&['GIF87a','GIF89a'].includes(ascii(0,6));
 if(!((type==='image/png'&&png)||(type==='image/jpeg'&&jpeg)||(type==='image/webp'&&webp)||(type==='image/gif'&&gif)))throw new ApiError(415,'Image content does not match a supported format.');
 return bytes;
}
module.exports={decodeImage};

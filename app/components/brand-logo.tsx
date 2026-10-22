import Image from 'next/image';
export function BrandLogo({className=''}:{className?:string}){
  return <span className={`brand-logo ${className}`}><Image src="/images/logo-lune.png" alt="Lune Alta Pastelería" width={503} height={496} unoptimized/></span>;
}

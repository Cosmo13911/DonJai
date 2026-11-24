import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'DonJai — บางความรู้สึก อยากให้เธอเก็บไว้',description:'สร้างเว็บของขวัญจากรูป จดหมาย และความทรงจำ ส่งความตั้งใจเป็นลิงก์ให้คนพิเศษ'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="th"><body>{children}</body></html>;}

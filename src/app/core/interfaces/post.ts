import { Author } from './author';
export interface Post {
  id:string,
  title:string,
  image:string,
  dateTime:string,
  author_id:string,
  description:string,
  imageUrl?:string,
  postUrl?:string,
  content?:string,
  author?:Author
}

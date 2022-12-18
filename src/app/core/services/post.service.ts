import { AuthorService } from './author.service';
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { map, mergeMap, Observable } from 'rxjs';

import { Post } from '../interfaces/post';


@Injectable({
  providedIn: 'root'
})
export class PostService {
  private posts!: Observable<Post[]>;

  constructor(private httpClient: HttpClient, private authorService:AuthorService) {}

  public getPosts():Observable<Array<Post>>{
    return this.posts ? this.posts : this.posts = this.httpClient.get<Array<Post>>("/assets/resources/posts.json");
  }

  public getPost(id:string):Observable<any>{
    return this.getPostContent(id).pipe(mergeMap((p)=>this.authorService.getAuthor(p.author_id).pipe(map(a=>{p["author"]=a; return p;}))));
  }

  public getPostContent(id:string):Observable<any>{
    if(!this.posts) this.getPosts();
    return this.posts.pipe(map(arr=>arr.find((p:Post)=>p.id==id)),
                          mergeMap(p=> this.getContent(id).pipe(
                              map(c=> {if(!p){ return p}else{p["content"]=c; return p}}))));
  }

  public getContent(id:string):Observable<string>{
    return this.httpClient.get<string>(`/assets/resources/content/${id}.html`,{
      headers: new HttpHeaders({
        'Accept': 'text/html, application/xhtml+xml, */*',
        'Content-Type': 'application/x-www-form-urlencoded'
      }),
      responseType: 'text' as 'json'
    });
  }
}

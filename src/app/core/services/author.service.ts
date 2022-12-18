import { Author } from './../interfaces/author';
import { Observable, map, find } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthorService {

constructor(private httpClient:HttpClient) { }

  getAuthors():Observable<Array<Author>>{
    return this.httpClient.get<Array<Author>>("/assets/resources/authors.json");
  }

  getAuthor(author_id:string):Observable<Author|undefined>{
    return this.getAuthors().pipe(map(obs=>obs[0]),find(a=>a.id === author_id));
  }
}

import { PostService } from './../../core/services/post.service';
import { Component, OnInit } from '@angular/core';
import { Post } from 'src/app/core/interfaces/post';

@Component({
  selector: 'app-home-page',
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.scss']
})
export class HomePageComponent implements OnInit {

  posts:Array<Post> = [];
  constructor(private postService:PostService) {
    postService.getPosts().subscribe(arr=>this.posts=arr);
   }

  ngOnInit() {
  }

}
